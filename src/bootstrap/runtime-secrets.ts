import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const ASM_SECRET_ID_SUFFIX = '_ASM_SECRET_ID';
const ASM_JSON_KEY_SUFFIX = '_ASM_JSON_KEY';
const ASM_REGION_SUFFIX = '_ASM_REGION';

export type AsmSecretBinding = {
  targetEnv: string;
  secretId: string;
  jsonKey?: string;
  region: string;
};

export type AsmSecretFetcher = (input: { secretId: string; region: string }) => Promise<string>;

const readNonEmptyEnv = (source: NodeJS.ProcessEnv, key: string) => {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

export const discoverAsmSecretBindings = (source: NodeJS.ProcessEnv = process.env): AsmSecretBinding[] => {
  return Object.entries(source)
    .filter(([key, value]) => key.endsWith(ASM_SECRET_ID_SUFFIX) && typeof value === 'string' && value.trim() !== '')
    .map(([key, value]) => {
      const targetEnv = key.slice(0, -ASM_SECRET_ID_SUFFIX.length);
      const region =
        readNonEmptyEnv(source, `${targetEnv}${ASM_REGION_SUFFIX}`) ??
        readNonEmptyEnv(source, 'ASM_REGION') ??
        readNonEmptyEnv(source, 'AWS_REGION') ??
        readNonEmptyEnv(source, 'AWS_DEFAULT_REGION');

      if (!region) {
        throw new Error(`ASM region is required for ${targetEnv}. Set ${targetEnv}${ASM_REGION_SUFFIX} or AWS_REGION.`);
      }

      return {
        targetEnv,
        secretId: value!.trim(),
        jsonKey: source[`${targetEnv}${ASM_JSON_KEY_SUFFIX}`]?.trim() || undefined,
        region: region.trim()
      };
    });
};

export const hasAsmSecretBinding = (targetEnv: string, source: NodeJS.ProcessEnv = process.env) =>
  Boolean(source[`${targetEnv}${ASM_SECRET_ID_SUFFIX}`]?.trim());

export const extractAsmSecretValue = (input: {
  targetEnv: string;
  secretId: string;
  secretString: string;
  jsonKey?: string;
}): string => {
  if (!input.jsonKey) {
    return input.secretString;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.secretString);
  } catch (error) {
    throw new Error(
      `ASM secret ${input.secretId} for ${input.targetEnv} must be valid JSON to use ${input.targetEnv}${ASM_JSON_KEY_SUFFIX}`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`ASM secret ${input.secretId} for ${input.targetEnv} must be a JSON object`);
  }

  const value = (parsed as Record<string, unknown>)[input.jsonKey];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`ASM secret ${input.secretId} for ${input.targetEnv} is missing string field ${input.jsonKey}`);
  }

  return value;
};

const createAsmSecretFetcher = (): AsmSecretFetcher => {
  const clients = new Map<string, SecretsManagerClient>();

  return async ({ secretId, region }) => {
    const client =
      clients.get(region) ??
      new SecretsManagerClient({
        region
      });

    clients.set(region, client);

    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: secretId
      })
    );

    if (typeof response.SecretString === 'string') {
      return response.SecretString;
    }

    if (response.SecretBinary) {
      return Buffer.from(response.SecretBinary).toString('utf8');
    }

    throw new Error(`ASM secret ${secretId} returned no SecretString or SecretBinary`);
  };
};

export const loadRuntimeSecretsFromAsm = async (
  source: NodeJS.ProcessEnv = process.env,
  fetchSecret: AsmSecretFetcher = createAsmSecretFetcher()
) => {
  const bindings = discoverAsmSecretBindings(source);
  if (bindings.length === 0) {
    return;
  }

  const secretCache = new Map<string, Promise<string>>();

  await Promise.all(
    bindings.map(async (binding) => {
      const cacheKey = `${binding.region}:${binding.secretId}`;
      const secretString =
        secretCache.get(cacheKey) ??
        fetchSecret({
          secretId: binding.secretId,
          region: binding.region
        });

      secretCache.set(cacheKey, secretString);

      source[binding.targetEnv] = extractAsmSecretValue({
        targetEnv: binding.targetEnv,
        secretId: binding.secretId,
        secretString: await secretString,
        jsonKey: binding.jsonKey
      });
    })
  );
};

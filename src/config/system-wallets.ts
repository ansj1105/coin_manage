import { env } from './env.js';

export type SystemWalletCode = 'treasury' | 'cold' | 'liquidity' | 'reward' | 'marketing' | 'hot';
export type SystemWalletCustody = 'multisig' | 'general';

export interface SystemWalletDescriptor {
  code: SystemWalletCode;
  label: string;
  address: string;
  custody: SystemWalletCustody;
  allocationPercent: number | null;
  allocationUnits: number | null;
  allocationLabel: string;
  notes: string;
  flowTags: string[];
}

const fallbackAddress = (value: string | undefined, code: string) => value ?? `unconfigured-${code}`;

export const getConfiguredSystemWallets = (): SystemWalletDescriptor[] => {
  const depositAddresses = env.depositWalletAddresses;

  return [
    {
      code: 'treasury',
      label: 'Treasury Wallet',
      address: env.treasuryWalletAddress,
      custody: 'multisig',
      allocationPercent: null,
      allocationUnits: null,
      allocationLabel: 'remainder reserve',
      notes: 'Foundation treasury reserve. Managed as multisig custody.',
      flowTags: ['Treasury Multisig']
    },
    {
      code: 'cold',
      label: 'Cold Wallet',
      address: fallbackAddress(depositAddresses[0], 'cold'),
      custody: 'multisig',
      allocationPercent: 50,
      allocationUnits: 150,
      allocationLabel: '50%',
      notes: 'Primary cold custody bucket for long-term reserve management.',
      flowTags: ['Cold Wallet', 'Multisig']
    },
    {
      code: 'liquidity',
      label: 'Liquidity Wallet',
      address: fallbackAddress(depositAddresses[1], 'liquidity'),
      custody: 'multisig',
      allocationPercent: 20,
      allocationUnits: 120,
      allocationLabel: '20%',
      notes: 'Operational liquidity wallet for market-making or settlement liquidity.',
      flowTags: ['Liquidity Wallet', 'Multisig']
    },
    {
      code: 'reward',
      label: 'Reward Wallet',
      address: fallbackAddress(depositAddresses[2], 'reward'),
      custody: 'multisig',
      allocationPercent: 23,
      allocationUnits: 150,
      allocationLabel: '23%',
      notes: 'Reward and mining distribution wallet managed with multisig custody.',
      flowTags: ['Reward Wallet', 'Multisig']
    },
    {
      code: 'marketing',
      label: 'Marketing Wallet',
      address: fallbackAddress(depositAddresses[3], 'marketing'),
      custody: 'multisig',
      allocationPercent: 4,
      allocationUnits: 120,
      allocationLabel: '4%',
      notes: 'Marketing and growth budget wallet managed with multisig custody.',
      flowTags: ['Marketing Wallet', 'Multisig']
    },
    {
      code: 'hot',
      label: 'Hot Wallet',
      address: env.hotWalletAddress,
      custody: 'general',
      allocationPercent: 3,
      allocationUnits: 200,
      allocationLabel: '3%',
      notes: 'Online hot wallet used for withdraw execution and user payout operations.',
      flowTags: ['Withdraw Core', 'User Withdraw', 'General Wallet']
    }
  ];
};

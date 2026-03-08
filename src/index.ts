import { createApp, buildDependencies } from './app.js';
import { env } from './config/env.js';

const app = createApp(buildDependencies());

app.listen(env.port, () => {
  console.log(`orion-kori-backend listening on port ${env.port}`);
});

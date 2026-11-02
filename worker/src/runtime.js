const { AsyncLocalStorage } = require('node:async_hooks');
const scope = new AsyncLocalStorage();
const updateScope = new AsyncLocalStorage();
const runWithEnv = (env, fn) => scope.run(env, fn);
const runWithUpdate = (id, fn) => updateScope.run(id, fn);
const currentUpdateId = () => updateScope.getStore() ?? null;
const environment = () => {
  const env = scope.getStore();
  if (!env) throw new Error('Worker environment is missing');
  return env;
};
const database = () => environment().DB;
module.exports = { runWithEnv, runWithUpdate, currentUpdateId, environment, database };

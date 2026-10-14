import { readPolicy } from './policy.mjs';
import { defaultHome } from './state.mjs';
console.log(JSON.stringify(await readPolicy(process.argv[2] || defaultHome())));

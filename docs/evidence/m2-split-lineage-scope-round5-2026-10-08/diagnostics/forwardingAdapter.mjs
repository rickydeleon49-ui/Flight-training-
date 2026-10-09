import { register } from 'node:module';

register(new URL('./forwardingLoader.mjs', import.meta.url));

export * from '../proof/lineageContract.mjs';

import { register } from 'node:module';
register(new URL('./importOnlyLoader.mjs', import.meta.url));

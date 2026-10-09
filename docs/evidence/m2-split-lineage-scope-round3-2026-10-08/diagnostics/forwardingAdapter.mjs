import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(__dirname, 'forwardingLoader.mjs')));

export * from '../proof/lineageContract.mjs';

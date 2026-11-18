import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(new URL('./resolve-ts-loader.mjs', import.meta.url));

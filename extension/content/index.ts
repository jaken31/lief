/**
 * Content script entry.
 *
 * Kept free of exports on purpose: a bundle with exports makes Rollup emit a named
 * global into the isolated world. The logic lives in main.ts, which tests import
 * directly so they can drive start() themselves.
 */
import { start } from './main';

start();

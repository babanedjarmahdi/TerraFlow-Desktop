#!/usr/bin/env node
import { run } from '../src/cli.js';

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (err) {
  console.error(`[terraflow] fatal: ${err?.message || err}`);
  process.exitCode = 1;
}
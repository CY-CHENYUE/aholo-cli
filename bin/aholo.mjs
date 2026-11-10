#!/usr/bin/env node
import { runCli } from '../dist/main.js';
process.exitCode = await runCli(process.argv.slice(2));

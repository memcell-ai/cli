#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { main } from "./main.js";

const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

process.exitCode = await main(process.argv.slice(2), version);

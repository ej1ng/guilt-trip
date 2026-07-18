import { autopsyCommand } from "./autopsy.js";
import { debugDbCommand } from "./debugdb.js";
import { suggestCommand } from "./suggest.js";

export const commands = [autopsyCommand, suggestCommand, debugDbCommand];

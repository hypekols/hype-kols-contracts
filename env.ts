import { config as dotenvConfig } from "dotenv";

dotenvConfig();

if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY is not set");
}
const PRIVATE_KEY = process.env.PRIVATE_KEY!;

export { PRIVATE_KEY };

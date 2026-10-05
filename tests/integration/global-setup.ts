import { prepareDatabase } from '../support/prepare-db';
import { TEST_DATABASE_URL } from './db-url';

export default async function setup() {
  await prepareDatabase(TEST_DATABASE_URL);
}

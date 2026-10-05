import { prepareDatabase } from './prepare-db';

prepareDatabase()
  .then(() => console.log('[tests] Test database ready.'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

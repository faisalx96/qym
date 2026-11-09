/** Strings of the experiment detail's Credentials row and notices (spec-b B4-28 to B4-37). */

export const CREDENTIALS_TITLE = 'Credentials';
export const CRED_API_KEY = 'API key';
export const CRED_DATASET_TOKEN = 'Dataset read token';
export const TOKEN_ENV_KEY = 'QYM_DATASET_READ_TOKEN';

/** Names of the environments whose schema does not declare the key, joined by `, `. */
export const notSentLead = (names: readonly string[]): string =>
  `Dataset read token not sent to ${names.join(', ')}:`;
export const notSentReason = (names: readonly string[]): string =>
  names.length === 1
    ? 'the environment’s schema does not declare'
    : 'the environments’ schemas do not declare';
export const notSentTail = (names: readonly string[]): string =>
  names.length === 1
    ? '. Its jobs read datasets with the Evaluation Service’s own token.'
    : '. Their jobs read datasets with the Evaluation Service’s own token.';

/** The backend's wait reason of a job whose token is gone (api `DATASET_TOKEN_UNAVAILABLE`). */
export const TOKEN_UNAVAILABLE_REASON =
  "The experiment's dataset read token is unavailable; retry to issue a new one";

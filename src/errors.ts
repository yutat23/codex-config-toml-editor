import { t } from './i18n.js';
export class UserError extends Error {}
export function errorMessage(error: unknown): string {
  return error instanceof UserError ? error.message : t("処理できませんでした。TOMLの構文とファイルへのアクセス権を確認してください。");
}


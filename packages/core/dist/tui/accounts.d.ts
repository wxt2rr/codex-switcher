export interface AccountListItem {
    envName: string;
    name: string;
    authMode: string;
    isCurrentCli?: boolean;
    isCurrentApp?: boolean;
    runtime?: {
        preferredAuthMethod?: string;
        openaiBaseUrl?: string;
    };
    apiKeyPreview?: string;
}
export declare function buildAccountsLines(accounts: AccountListItem[]): string[];
export declare function renderAccountsScreen(input: {
    accounts: AccountListItem[];
    offset?: number;
    viewLines?: number;
}): string;

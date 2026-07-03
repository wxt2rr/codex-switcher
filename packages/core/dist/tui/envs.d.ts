export interface EnvListItem {
    name: string;
    path: string;
    isCurrentCli?: boolean;
    isCurrentApp?: boolean;
    accountCount: number;
}
export declare function buildEnvsLines(envs: EnvListItem[]): string[];
export declare function renderEnvsScreen(input: {
    envs: EnvListItem[];
    offset?: number;
    viewLines?: number;
}): string;

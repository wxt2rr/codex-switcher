export interface SetupOption {
    id: string;
    title: string;
    description: string;
}
export declare const SETUP_OPTIONS_WINDOWS: SetupOption[];
export declare const SETUP_OPTIONS_UNIX: SetupOption[];
export declare function renderSetupScreen(input: {
    platform: string;
    options: SetupOption[];
    statusLines: string[];
    selected?: number;
    selectedTargetPath?: string;
    message?: string;
}): string;

export interface CommandsApi {
  onCommand: {
    addListener: (callback: (command: string) => void) => void;
  };
}

export const VOICE_COMMAND = 'activate-voice';

export function registerCommands(api: CommandsApi, handler: () => void): void {
  api.onCommand.addListener((command) => {
    if (command === VOICE_COMMAND) handler();
  });
}

export type OpenWikiCommand = "init" | "update";

export type OpenWikiRunResult = {
  command: OpenWikiCommand;
  model: string;
};

export type OpenWikiRunEvent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "tool_call";
      call: string;
    }
  | {
      type: "debug";
      message: string;
    };

export type OpenWikiRunOptions = {
  debug?: boolean;
  onEvent?: (event: OpenWikiRunEvent) => void;
};

export type UpdateMetadata = {
  updatedAt: string;
  command: OpenWikiCommand;
  model: string;
};

export type RunContext = {
  lastUpdate: UpdateMetadata | null;
  gitSummary: string;
};

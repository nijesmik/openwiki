import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type WorkflowWriteStatus = "created" | "unchanged";
export type WorkflowStatus = "different" | "missing" | "unchanged";

export type WorkflowWriteResult = {
  path: string;
  status: WorkflowWriteStatus;
};

export const openWikiWorkflowPath = ".github/workflows/openwiki-update.yml";

const workflowContent = [
  "name: OpenWiki Update",
  "",
  "on:",
  "  workflow_dispatch:",
  "  schedule:",
  "    # GitHub schedules use UTC; 08:00 UTC is midnight PST.",
  '    - cron: "0 8 * * *"',
  "",
  "permissions:",
  "  contents: write",
  "",
  "jobs:",
  "  update:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Check out repository",
  "        uses: actions/checkout@v4",
  "        with:",
  "          persist-credentials: true",
  "",
  "      - name: Set up Node.js",
  "        uses: actions/setup-node@v4",
  "        with:",
  '          node-version: "22"',
  "",
  "      - name: Install OpenWiki",
  "        run: npm install --global openwiki",
  "",
  "      - name: Run OpenWiki update",
  "        run: openwiki update",
  "        env:",
  "          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
  "          LANGSMITH_API_KEY: ${{ secrets.LANGSMITH_API_KEY }}",
  "          LANGCHAIN_PROJECT: openwiki",
  '          LANGCHAIN_TRACING_V2: "true"',
  "",
  "      - name: Commit OpenWiki changes",
  "        run: |",
  '          if [ -z "$(git status --porcelain openwiki)" ]; then',
  '            echo "No OpenWiki documentation changes to commit."',
  "            exit 0",
  "          fi",
  "",
  '          git config user.name "github-actions[bot]"',
  '          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
  "          git add openwiki",
  '          git commit -m "docs: update OpenWiki"',
  "          git push",
  "",
].join("\n");

export async function writeOpenWikiUpdateWorkflow(
  cwd = process.cwd(),
): Promise<WorkflowWriteResult> {
  const workflowFilePath = path.join(cwd, openWikiWorkflowPath);

  try {
    const currentContent = await readFile(workflowFilePath, "utf8");

    if (currentContent === workflowContent) {
      return {
        path: openWikiWorkflowPath,
        status: "unchanged",
      };
    }

    throw new Error(
      `Refusing to overwrite existing GitHub Action at ${openWikiWorkflowPath}.`,
    );
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }

  await mkdir(path.dirname(workflowFilePath), {
    recursive: true,
  });
  await writeFile(workflowFilePath, workflowContent, "utf8");

  return {
    path: openWikiWorkflowPath,
    status: "created",
  };
}

export async function getOpenWikiUpdateWorkflowStatus(
  cwd = process.cwd(),
): Promise<WorkflowStatus> {
  const workflowFilePath = path.join(cwd, openWikiWorkflowPath);

  try {
    const currentContent = await readFile(workflowFilePath, "utf8");

    return currentContent === workflowContent ? "unchanged" : "different";
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return "missing";
    }

    throw error;
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

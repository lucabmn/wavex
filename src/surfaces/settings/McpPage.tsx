import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { EmptyNote, Row, SecondaryButton, Section, Toggle } from "../../chrome/SettingsRow";
import { listMcpServers, probeMcpServer } from "../../lib/mcp/discovery";
import {
  isMcpServerEnabled,
  mcpServerChoicesSnapshot,
  setMcpServerEnabled,
  subscribeMcpServerChoices,
} from "../../lib/mcp/enabled";
import {
  groupMcpServers,
  mcpGroupBlockedReason,
  mcpServerDetail,
  mcpSourceSummary,
  usableMcpDefinition,
  type McpServer,
  type McpServerGroup,
  type McpTool,
} from "../../lib/mcp/types";
import { HARNESS_TITLE, type HarnessId } from "../../lib/session";

type ToolsState =
  | { state: "loading" }
  | { state: "ready"; tools: McpTool[] }
  | { state: "failed"; message: string };

/**
 * MCP servers are read, not registered. The page reports what the installed
 * agent CLIs have configured and which of those wavex passes on — the same
 * posture it takes with skills and language servers.
 */
export function McpPage({ cwd }: { cwd: string }) {
  useSyncExternalStore(
    subscribeMcpServerChoices,
    mcpServerChoicesSnapshot,
    mcpServerChoicesSnapshot,
  );
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [tools, setTools] = useState<Record<string, ToolsState>>({});

  useEffect(() => {
    let live = true;
    setServers(null);
    setTools({});
    void listMcpServers(cwd)
      .then((found) => {
        if (live) setServers(found);
      })
      .catch(() => {
        if (live) setServers([]);
      });
    return () => {
      live = false;
    };
  }, [cwd]);

  const onProbe = useCallback(
    (group: McpServerGroup) => {
      const definition = group.definitions.find(usableMcpDefinition);
      if (!definition) return;
      setTools((current) => ({ ...current, [group.name]: { state: "loading" } }));
      void probeMcpServer(cwd, definition)
        .then((result) => {
          setTools((current) => ({
            ...current,
            [group.name]: result.ok
              ? { state: "ready", tools: result.tools }
              : { state: "failed", message: result.error ?? "The server did not answer" },
          }));
        })
        .catch((error: unknown) => {
          setTools((current) => ({
            ...current,
            [group.name]: { state: "failed", message: String(error) },
          }));
        });
    },
    [cwd],
  );

  const groups = groupMcpServers(servers ?? []);

  return (
    <>
      <p className="pb-5 text-[12px] leading-relaxed text-content/45">
        wavex uses the MCP servers your agent CLIs already have configured and never installs one.
        None are passed on until you turn them on here, because a server is a program the agent
        would run. Claude Code and Codex read their own configuration either way — this decides what
        Cursor, fx, and Grok Build are started with.
      </p>

      {servers === null ? (
        <Section title="Configured servers">
          <EmptyNote>Reading the CLIs&rsquo; configuration…</EmptyNote>
        </Section>
      ) : groups.length === 0 ? (
        <Section
          title="Configured servers"
          description="Found in each CLI's own configuration file."
        >
          <EmptyNote>
            No MCP servers configured. Add one with your agent CLI and it appears here.
          </EmptyNote>
        </Section>
      ) : (
        <Section
          title="Configured servers"
          description="Found in each CLI's own configuration file. wavex reads these and never writes them."
        >
          {groups.map((group) => (
            <ServerRow key={group.name} group={group} tools={tools[group.name]} onProbe={onProbe} />
          ))}
        </Section>
      )}
    </>
  );
}

function ServerRow({
  group,
  tools,
  onProbe,
}: {
  group: McpServerGroup;
  tools: ToolsState | undefined;
  onProbe: (group: McpServerGroup) => void;
}) {
  const blocked = mcpGroupBlockedReason(group);
  const sources = mcpSourceSummary(group, harnessTitle);
  const detail = mcpServerDetail(group.definitions[0]);

  return (
    <>
      <Row
        label={group.name}
        description={
          blocked
            ? `${sources} · ${blocked}`
            : [sources, detail].filter((part) => part.length > 0).join(" · ")
        }
      >
        <SecondaryButton onClick={() => onProbe(group)} disabled={blocked !== null}>
          {tools?.state === "loading" ? "Asking…" : "Show tools"}
        </SecondaryButton>
        <Toggle
          label={`Pass ${group.name} to agents wavex starts`}
          on={isMcpServerEnabled(group.name)}
          disabled={blocked !== null}
          onChange={(next) => setMcpServerEnabled(group.name, next)}
        />
      </Row>
      {tools ? <Tools tools={tools} /> : null}
    </>
  );
}

/**
 * Asking a server for its tools means starting it, so the answer appears only
 * where the user asked for it — and its own words when it fails, because
 * "could not connect" leaves nowhere to go.
 */
function Tools({ tools }: { tools: ToolsState }) {
  if (tools.state === "loading") {
    return <p className="px-4 pb-3.5 text-[12px] text-content/45">Starting the server…</p>;
  }
  if (tools.state === "failed") {
    return <p className="px-4 pb-3.5 text-[12px] text-red-400/80">{tools.message}</p>;
  }
  if (tools.tools.length === 0) {
    return <p className="px-4 pb-3.5 text-[12px] text-content/45">The server has no tools.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pb-3.5">
      {tools.tools.map((tool) => (
        <span
          key={tool.name}
          title={tool.description}
          className="rounded border border-content/10 px-1.5 py-0.5 font-mono text-[11px] text-content/60"
        >
          {tool.name}
        </span>
      ))}
    </div>
  );
}

/** A source is a harness id when wavex knows it, and its own name otherwise. */
function harnessTitle(source: string): string {
  return HARNESS_TITLE[source as HarnessId] ?? source;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadPromptTemplates,
  peekPromptTemplates,
  templateProjectKey,
  templateProjectPath,
  type PromptTemplate,
} from "../lib/project/promptTemplates";

/**
 * Project templates for the composer picker. Keyed on the project rather than
 * the harness: switching provider or model in a session must not change what
 * the picker offers.
 */
export function usePromptTemplates(input: { cwd: string; pickerOpen: boolean }) {
  const projectPath = useMemo(() => templateProjectPath(input.cwd), [input.cwd]);
  const projectKey = useMemo(() => templateProjectKey(input.cwd), [input.cwd]);
  const [templates, setTemplates] = useState<PromptTemplate[]>(
    () => peekPromptTemplates(projectKey) ?? [],
  );
  const keyRef = useRef(projectKey);
  keyRef.current = projectKey;

  const refresh = useCallback(async (force = false) => {
    const key = keyRef.current;
    const next = await loadPromptTemplates(key, force);
    // The project can change while the load is in flight; a stale list would
    // offer another project's prompts.
    if (keyRef.current !== key) return;
    // Reusing the previous array when nothing changed keeps the picker's
    // highlighted row where the user put it across a refresh.
    setTemplates((prev) => (sameTemplates(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    setTemplates(peekPromptTemplates(projectKey) ?? []);
    void refresh().catch(() => undefined);
  }, [projectKey, refresh]);

  useEffect(() => {
    if (!input.pickerOpen) return;
    void refresh(true).catch(() => undefined);
  }, [input.pickerOpen, refresh]);

  return { projectKey, projectPath, templates, refresh };
}

function sameTemplates(a: PromptTemplate[], b: PromptTemplate[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((template, index) => {
    const other = b[index];
    return template.id === other?.id && template.updatedAt === other.updatedAt;
  });
}

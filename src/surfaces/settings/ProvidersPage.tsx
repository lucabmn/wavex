import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronDown } from "../../chrome/icons";
import { HarnessIcon } from "../../chrome/HarnessIcon";
import { Row, SecondaryButton, Select, Toggle } from "../../chrome/SettingsRow";
import {
  getHarnessAvailabilitySnapshot,
  harnessUnavailableHint,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../../lib/harness/availability";
import { refreshHarnessCatalogs } from "../../lib/harness/registry";
import {
  defaultModelId,
  enabledModelsFor,
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  gitWritingChoice,
  isModelEnabled,
  isPickerProviderVisible,
  loadDefaultModels,
  loadGitWritingChoice,
  loadLastModelChoice,
  modelsFor,
  preferredModelId,
  resolveModel,
  saveDefaultModel,
  saveGitWritingChoice,
  saveLastModelChoice,
  savePickerProviderVisible,
  setModelEnabled,
  subscribeGitWritingChoice,
  subscribeModels,
  subscribePickerVisibility,
} from "../../lib/models";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../../lib/session";

export function ProvidersPage() {
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    getPickerVisibilitySnapshot,
  );
  const [choice, setChoice] = useState(loadLastModelChoice);
  const [defaultModels, setDefaultModels] = useState(loadDefaultModels);
  const [gitWritings, setGitWritings] = useState(gitWritingChoice);

  useEffect(() => {
    void probeHarnessAvailability();
  }, []);

  useEffect(
    () =>
      subscribeGitWritingChoice(() => {
        setGitWritings(loadGitWritingChoice() ?? gitWritingChoice());
      }),
    [],
  );

  const onModelChange = (harness: HarnessId, model: string) => {
    saveDefaultModel(harness, model);
    setDefaultModels((prev) => ({ ...prev, [harness]: model }));
    if (choice?.harness === harness) {
      saveLastModelChoice(harness, model);
      setChoice({ harness, model });
    }
  };

  const onDefault = (harness: HarnessId, model: string) => {
    saveLastModelChoice(harness, model);
    setDefaultModels((prev) => ({ ...prev, [harness]: model }));
    setChoice({ harness, model });
  };

  // Turning a model off can move a provider's default, so the page re-reads
  // rather than trusting what it rendered a moment ago.
  const onModelEnabled = (id: string, enabled: boolean) => {
    setModelEnabled(id, enabled);
    setDefaultModels(loadDefaultModels());
    setChoice(loadLastModelChoice());
  };

  const onGitWritingHarness = (harness: HarnessId) => {
    const model = preferredModelId(harness);
    saveGitWritingChoice(harness, model);
    setGitWritings({ harness, model });
  };

  const onGitWritingModel = (model: string) => {
    saveGitWritingChoice(gitWritings.harness, model);
    setGitWritings({ harness: gitWritings.harness, model });
  };

  return (
    <>
      <p className="pb-5 text-[12px] leading-relaxed text-content/45">
        A provider is listed as installed once its CLI is found on your PATH. Uninstalled CLIs stay
        listed here but are omitted from the model picker. The model beside each provider is what
        new conversations use when that provider is selected; Use by default picks the provider
        itself.
      </p>
      <GitWritingsRow
        harness={gitWritings.harness}
        model={gitWritings.model}
        onHarnessChange={onGitWritingHarness}
        onModelChange={onGitWritingModel}
      />
      {HARNESSES.map((harness) => (
        <ProviderCard
          key={harness}
          harness={harness}
          selectedModel={
            defaultModels[harness] ??
            (choice?.harness === harness ? choice.model : defaultModelId(harness))
          }
          isDefault={choice?.harness === harness}
          onDefault={onDefault}
          onModelChange={onModelChange}
          onModelEnabled={onModelEnabled}
        />
      ))}
    </>
  );
}

function GitWritingsRow({
  harness,
  model,
  onHarnessChange,
  onModelChange,
}: {
  harness: HarnessId;
  model: string;
  onHarnessChange: (harness: HarnessId) => void;
  onModelChange: (model: string) => void;
}) {
  const models = modelsFor(harness);
  const current = models.length > 0 ? resolveModel(harness, model) : null;

  useEffect(() => {
    if (!isHarnessAvailable(harness) || models.length > 0) return;
    void refreshHarnessCatalogs([harness]);
  }, [harness, models.length]);

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-content/10 bg-content/[0.025]">
      <Row
        label="Git writings"
        description="Provider and model for generated commit messages, PR content, and branch names. Project skills that read like commit, PR, or branch guidance — a commit skill, for example — are folded into those prompts."
      >
        <Select
          label="Git writings provider"
          value={harness}
          onChange={(next) => onHarnessChange(next as HarnessId)}
          options={HARNESSES.map((id) => ({
            value: id,
            label: HARNESS_TITLE[id],
          }))}
        />
        {current ? (
          <Select
            label="Git writings model"
            value={current.id}
            onChange={onModelChange}
            options={models.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
        ) : (
          <span className="text-[12px] text-content/45">
            {isHarnessAvailable(harness)
              ? "Loading models…"
              : (harnessUnavailableHint(harness) ?? "Provider not installed.")}
          </span>
        )}
      </Row>
    </div>
  );
}

function ProviderCard({
  harness,
  selectedModel,
  isDefault,
  onDefault,
  onModelChange,
  onModelEnabled,
}: {
  harness: HarnessId;
  selectedModel: string;
  isDefault: boolean;
  onDefault: (harness: HarnessId, model: string) => void;
  onModelChange: (harness: HarnessId, model: string) => void;
  onModelEnabled: (id: string, enabled: boolean) => void;
}) {
  const models = modelsFor(harness);
  const enabled = enabledModelsFor(harness);
  const available = isHarnessAvailable(harness);
  const current = models.length > 0 ? resolveModel(harness, selectedModel) : null;
  const [showModels, setShowModels] = useState(false);
  const inPicker = isPickerProviderVisible(harness);

  useEffect(() => {
    if (!available || models.length > 0) return;
    void refreshHarnessCatalogs([harness]);
  }, [available, harness, models.length]);

  // The saved default can be a model that was turned off later. It stays in the
  // list, marked, rather than the select rendering blank against a value it
  // does not carry.
  const options = enabled.map((model) => ({ value: model.id, label: model.name }));
  if (current && !options.some((option) => option.value === current.id)) {
    options.unshift({ value: current.id, label: `${current.name} (off)` });
  }

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-content/10 bg-content/[0.025]">
      <header className="flex flex-wrap items-center gap-3 border-b border-content/8 px-4 py-3">
        <HarnessIcon harness={harness} className="size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-medium text-content">
            {HARNESS_TITLE[harness]}
            {isDefault ? (
              <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                Default
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[12px] text-content/45">
            {available
              ? `${enabled.length} of ${models.length} ${models.length === 1 ? "model" : "models"} on.`
              : harnessUnavailableHint(harness)}
          </p>
        </div>
        <SecondaryButton
          onClick={() => current && onDefault(harness, current.id)}
          disabled={isDefault || !current}
        >
          {isDefault ? "Default" : "Use by default"}
        </SecondaryButton>
      </header>

      <Row label="Model for new conversations" description="Used whenever this provider is picked.">
        <Select
          label={`${HARNESS_TITLE[harness]} model`}
          value={current?.id ?? ""}
          disabled={!current}
          options={current ? options : [{ value: "", label: "No models" }]}
          onChange={(next) => onModelChange(harness, next)}
        />
      </Row>

      {available ? (
        <Row
          label="Show in picker"
          description="Hide this provider from the model picker without uninstalling its CLI."
        >
          <Toggle
            label={`Show ${HARNESS_TITLE[harness]} in the model picker`}
            on={inPicker}
            onChange={(visible) => savePickerProviderVisible(harness, visible)}
          />
        </Row>
      ) : null}

      {models.length > 0 ? (
        <div className="border-b border-content/8 last:border-b-0">
          <button
            type="button"
            aria-expanded={showModels}
            onClick={() => setShowModels((open) => !open)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-medium text-content hover:bg-content/5"
          >
            <ChevronDown
              className={`size-3.5 shrink-0 text-content/40 transition-transform ${
                showModels ? "" : "-rotate-90"
              }`}
              strokeWidth={1.75}
            />
            Models
            <span className="ml-auto text-[12px] font-normal text-content/40">
              {enabled.length === models.length
                ? "All on"
                : enabled.length === 0
                  ? "All off"
                  : `${models.length - enabled.length} off`}
            </span>
          </button>
          {showModels ? (
            <div className="border-t border-content/8">
              <p className="px-4 pt-3 text-[12px] leading-relaxed text-content/40">
                A model you turn off leaves the picker, racing, and second opinions. Conversations
                already running on it keep running on it.
              </p>
              <ul className="px-4 py-2">
                {models.map((model) => {
                  const on = isModelEnabled(model.id);
                  return (
                    <li
                      key={model.id}
                      className="flex items-center gap-3 border-b border-content/5 py-2 last:border-b-0"
                    >
                      <span
                        className={`min-w-0 flex-1 truncate text-[12.5px] ${
                          on ? "text-content" : "text-content/35"
                        }`}
                      >
                        {model.name}
                      </span>
                      <Toggle
                        label={`Offer ${model.name}`}
                        on={on}
                        onChange={(next) => onModelEnabled(model.id, next)}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

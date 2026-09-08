import { useState } from "react";
import { DeleteProfileDialog } from "../../chrome/DeleteProfileDialog";
import { ProfileAvatar } from "../../chrome/ProfileAvatar";
import { ProfileDialog } from "../../chrome/ProfileDialog";
import { Row, SectionBody, Section } from "../../chrome/SettingsRow";
import { useProfiles } from "../../hooks/useProfiles";
import { canDeleteProfile, type Profile } from "../../lib/profiles/profile";
import { createProfile, deleteProfile, updateProfile } from "../../lib/profiles/profileStore";

export function ProfilesPage({ onSwitchProfile }: { onSwitchProfile: (id: string) => void }) {
  const { profiles, active } = useProfiles();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDelete = (profile: Profile) => {
    setDeleting(null);
    deleteProfile(profile.id).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not delete that profile");
    });
  };

  return (
    <>
      <Section
        title="Profiles"
        description="Each one is its own workspace inside this copy of wavex."
      >
        {profiles.map((profile) => (
          <Row
            key={profile.id}
            label={
              <span className="flex items-center gap-2">
                <ProfileAvatar profile={profile} size="md" />
                <span className="min-w-0 truncate">{profile.name}</span>
                {profile.id === active.id ? (
                  <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-medium text-accent">
                    Active
                  </span>
                ) : null}
              </span>
            }
            description={
              profile.id === active.id
                ? "The workspace on screen: its projects, chats, agents, and layout."
                : "Its own projects, chats, agents, and layout, kept until you switch back."
            }
          >
            {profile.id === active.id ? null : (
              <button
                type="button"
                onClick={() => onSwitchProfile(profile.id)}
                className="rounded-md px-2.5 py-1.5 text-[12px] text-content/70 hover:bg-hover hover:text-content"
              >
                Switch to
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(profile)}
              className="rounded-md px-2.5 py-1.5 text-[12px] text-content/70 hover:bg-hover hover:text-content"
            >
              Edit…
            </button>
            <button
              type="button"
              disabled={!canDeleteProfile(profile.id) || profile.id === active.id}
              title={
                !canDeleteProfile(profile.id)
                  ? "The first profile is wavex itself and cannot be deleted"
                  : profile.id === active.id
                    ? "Switch to another profile first"
                    : undefined
              }
              onClick={() => setDeleting(profile)}
              className="rounded-md px-2.5 py-1.5 text-[12px] text-red-300/80 hover:bg-red-500/15 hover:text-red-300 disabled:cursor-default disabled:text-content/25 disabled:hover:bg-transparent"
            >
              Delete
            </button>
          </Row>
        ))}

        <Row
          label="New profile"
          description="Starts empty: no projects, no chats, no tabs carried over."
        >
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md bg-content/10 px-2.5 py-1.5 text-[12px] font-medium text-content hover:bg-hover"
          >
            Add profile
          </button>
        </Row>
      </Section>

      {error ? <p className="pb-4 text-[12px] text-red-300">{error}</p> : null}

      <Section title="What profiles do not separate">
        <SectionBody>
          <p className="max-w-xl text-[12px] leading-relaxed text-content/45">
            Agent CLIs hold their own sign-in and their own agent definitions on disk, outside
            wavex. Every profile drives the same installed CLIs, so switching profiles does not
            switch provider accounts.
          </p>
          <p className="max-w-xl pt-2 text-[12px] leading-relaxed text-content/45">
            Switching stops the agents and terminals running in the profile you leave, exactly as
            quitting wavex does. Their chats come back with Continue when you switch back.
          </p>
        </SectionBody>
      </Section>

      {creating ? (
        <ProfileDialog
          title="New profile"
          description="A separate workspace inside this copy of wavex."
          confirmLabel="Create and switch"
          onCancel={() => setCreating(false)}
          onConfirm={(name, color) => {
            setCreating(false);
            onSwitchProfile(createProfile(name, color).id);
          }}
        />
      ) : null}

      {editing ? (
        <ProfileDialog
          title="Edit profile"
          description="Name and color decide how this profile reads in the chrome."
          confirmLabel="Save"
          initialName={editing.name}
          initialColor={editing.color}
          onCancel={() => setEditing(null)}
          onConfirm={(name, color) => {
            updateProfile(editing.id, { name, color });
            setEditing(null);
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteProfileDialog
          profile={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => onDelete(deleting)}
        />
      ) : null}
    </>
  );
}

import { useRef } from "react";
import { IMAGE_FILE_ACCEPT, MAX_IMAGE_BYTES } from "@/core/gateways/http/uploadImage";
import { Icon } from "@/shared/icons/Icon";

export type ImageDraft = { url: string; file: File | null };

export function AppearanceImageField({
  kind, title, help, draft, error, onChange, onError, inputRef,
}: {
  kind: "LOGO" | "COVER";
  title: string;
  help: string;
  draft: ImageDraft;
  error?: string | null;
  onChange: (draft: ImageDraft) => void;
  onError: (error: string) => void;
  inputRef: (element: HTMLInputElement | null) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const id = `appearance-${kind.toLowerCase()}`;
  const hasImage = Boolean(draft.file || draft.url);

  return (
    <section className="appearance__section" aria-labelledby={`${id}-label`}>
      <h2 id={`${id}-label`}>{title}</h2>
      <p>{help}</p>
      <div className="appearance__file-row">
        <input type="file" ref={fileInput} accept={IMAGE_FILE_ACCEPT} aria-label={`Arquivo de ${title.toLowerCase()}`} hidden onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          if (file.size > MAX_IMAGE_BYTES) {
            onError("Escolha uma imagem de até 8 MB.");
            return;
          }
          onChange({ url: "", file });
        }} />
        <button className="appearance__button" type="button" onClick={() => fileInput.current?.click()} aria-label={`Enviar imagem de ${title.toLowerCase()}`}>
          <Icon name="image" aria-hidden="true" />
          {draft.file ? "Trocar arquivo" : "Escolher arquivo"}
        </button>
        <span className="appearance__file-name">{draft.file?.name ?? "JPG, PNG ou WebP · até 8 MB"}</span>
      </div>
      <label htmlFor={id}>{kind === "COVER" ? "URL do banner (opcional)" : "URL do logotipo (opcional)"}</label>
      <div className="appearance__image-url">
        <input id={id} ref={inputRef} type="text" inputMode="url" autoComplete="off" spellCheck={false}
          value={draft.url} placeholder="https://..." aria-invalid={Boolean(error)} maxLength={500}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange({ url: event.target.value, file: null })} />
        {hasImage && <button type="button" className="appearance__text-button" aria-label={`Remover ${title.toLowerCase()}`}
          onClick={() => onChange({ url: "", file: null })}>Remover</button>}
      </div>
      {error && <p className="appearance__error" id={`${id}-error`} role="alert">{error}</p>}
    </section>
  );
}

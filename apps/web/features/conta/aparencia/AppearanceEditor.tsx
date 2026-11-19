import { useRef, useState, type FormEvent } from "react";
import type { StoreSettings, StoreSettingsInput } from "@/core/domain/store";
import { uploadImage } from "@/core/gateways/http/uploadImage";
import { normalizeAccent } from "@/features/loja/theme";
import { validateStoreImageUrl } from "@/shared/format/imageUrl";
import { Icon } from "@/shared/icons/Icon";
import { StoreIdentityPreview } from "../components/StoreIdentityPreview";
import type { SaveMessage } from "../hooks/useConta";
import { AppearanceImageField, type ImageDraft } from "./AppearanceImageField";

const COLORS = [
  { hex: "#1f7a54", label: "Verde" },
  { hex: "#b7472a", label: "Terracota" },
  { hex: "#244b8c", label: "Azul" },
  { hex: "#7d385d", label: "Vinho" },
  { hex: "#916124", label: "Âmbar" },
  { hex: "#242827", label: "Carvão" },
];

const IMAGE_FIELDS = [
  { key: "coverImageUrl", kind: "COVER", title: "Banner principal", help: "Imagem horizontal no topo do cardápio. Use uma foto de 1600 × 800 px para aproveitar o enquadramento." },
  { key: "logoUrl", kind: "LOGO", title: "Logotipo", help: "Imagem quadrada exibida ao lado do nome da loja." },
] as const;

type ImageKey = (typeof IMAGE_FIELDS)[number]["key"];
type Draft = { primaryColor: string } & Record<ImageKey, ImageDraft>;
type Errors = Partial<Record<keyof Draft, string | null>>;

function draftFrom(store: StoreSettings): Draft {
  return {
    primaryColor: store.primaryColor ?? "",
    coverImageUrl: { url: store.coverImageUrl ?? "", file: null },
    logoUrl: { url: store.logoUrl ?? "", file: null },
  };
}

export function AppearanceEditor({
  store,
  canEdit,
  readOnly,
  onSave,
}: {
  store: StoreSettings;
  canEdit: boolean;
  readOnly: boolean;
  onSave: (input: StoreSettingsInput) => Promise<SaveMessage>;
}) {
  const [draft, setDraft] = useState(() => draftFrom(store));
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Partial<Record<keyof Draft, HTMLInputElement | null>>>({});
  const inFlight = useRef(false);
  const saved = draftFrom(store);
  const color = draft.primaryColor.trim();
  const dirty = color !== saved.primaryColor || IMAGE_FIELDS.some(({ key }) => draft[key].file || draft[key].url.trim() !== saved[key].url);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: null }));
    setMessage(null);
  }

  function discard() {
    setDraft(saved);
    setMessage(null);
    setErrors({});
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !dirty || !canEdit) return;

    const nextErrors: Errors = {};
    if (color && color !== saved.primaryColor && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      nextErrors.primaryColor = "Informe um código HEX no formato #RRGGBB.";
    }
    for (const { key } of IMAGE_FIELDS) {
      if (!draft[key].file && draft[key].url.trim() !== saved[key].url) nextErrors[key] = validateStoreImageUrl(draft[key].url);
    }
    setMessage(null);
    setErrors(nextErrors);
    const firstError = (Object.keys(nextErrors) as (keyof Draft)[]).find((key) => nextErrors[key]);
    if (firstError) {
      inputs.current[firstError]?.focus();
      return;
    }

    inFlight.current = true;
    setBusy(true);
    try {
      const input: StoreSettingsInput = {};
      if (color !== saved.primaryColor) input.primaryColor = color.toLowerCase();
      for (const { key, kind } of IMAGE_FIELDS) {
        const { file, url } = draft[key];
        if (file) {
          const result = await uploadImage(kind, file);
          if (!result.ok) {
            setErrors({ [key]: result.error });
            return;
          }
          const uploadedUrl = result.data.image.url;
          const error = validateStoreImageUrl(uploadedUrl);
          if (error) {
            setErrors({ [key]: "O armazenamento da loja precisa de um endereço público válido para imagens." });
            return;
          }
          input[key] = uploadedUrl;
          setDraft((current) => ({ ...current, [key]: { url: uploadedUrl, file: null } }));
        } else if (url.trim() !== saved[key].url) {
          input[key] = url.trim();
        }
      }
      const result = await onSave(input);
      if (result.kind === "ok" && result.settings) setDraft(draftFrom(result.settings));
      setMessage(result.kind === "ok" ? { kind: "ok", text: "Aparência salva. O cardápio público pode levar alguns instantes para atualizar." } : result);
    } catch {
      setMessage({ kind: "error", text: "Não foi possível salvar a aparência. Tente novamente." });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const accent = normalizeAccent(color);
  return (
    <div className="appearance__layout">
      <form className="appearance__editor" onSubmit={(event) => void save(event)}>
        {readOnly && <p className="appearance__feedback">Somente o dono da loja pode publicar alterações na aparência.</p>}
        <fieldset className="appearance__fieldset" disabled={!canEdit || busy}>
          <section className="appearance__section" aria-labelledby="appearance-colors">
            <h2 id="appearance-colors">Cor de destaque</h2>
            <p>Usada em botões, preços e categorias ativas.</p>
            <div className="appearance__palette" role="group" aria-label="Cores sugeridas">
              {COLORS.map(({ hex, label }) => (
                <button key={hex} type="button" aria-label={label} aria-pressed={accent === hex}
                  onClick={() => update("primaryColor", hex)} className="appearance__swatch">
                  <span style={{ backgroundColor: hex }} />
                </button>
              ))}
            </div>
            <div className="appearance__color-controls">
              <div>
                <label htmlFor="appearance-color-hex">Código HEX</label>
                <div className="appearance__color-input">
                  <input aria-label="Escolher uma cor personalizada" type="color" value={accent}
                    onChange={(event) => update("primaryColor", event.target.value)} />
                  <input id="appearance-color-hex" ref={(input) => { inputs.current.primaryColor = input; }}
                    spellCheck={false} maxLength={7} value={draft.primaryColor}
                    placeholder="#1F7A54" aria-invalid={Boolean(errors.primaryColor)}
                    aria-describedby={errors.primaryColor ? "appearance-color-error" : undefined}
                    onChange={(event) => update("primaryColor", event.target.value)} />
                </div>
              </div>
              <button className="appearance__text-button" type="button" onClick={() => update("primaryColor", "")}
                disabled={!color}>Usar cor padrão</button>
            </div>
            {errors.primaryColor && <p className="appearance__error" id="appearance-color-error" role="alert">{errors.primaryColor}</p>}
          </section>

          {IMAGE_FIELDS.map(({ key, kind, title, help }) => (
            <AppearanceImageField key={key} kind={kind} title={title} help={help} draft={draft[key]} error={errors[key]}
              onChange={(value) => update(key, value)}
              onError={(error) => setErrors((current) => ({ ...current, [key]: error }))}
              inputRef={(input) => { inputs.current[key] = input; }} />
          ))}

          {canEdit && <div className="appearance__actions">
            <button className="appearance__button" type="button" disabled={!dirty} onClick={discard}>Descartar</button>
            <button className="appearance__button appearance__button--primary" type="submit" disabled={!dirty}>
              {busy ? "Salvando…" : "Salvar aparência"}
            </button>
          </div>}
        </fieldset>
        {message && (
          <p className={`appearance__message appearance__message--${message.kind}`} role={message.kind === "ok" ? "status" : "alert"}>
            {message.kind === "ok" && <Icon name="check" aria-hidden="true" />}
            {message.text}
          </p>
        )}
      </form>
      <StoreIdentityPreview store={store} primaryColor={color} logo={draft.logoUrl} cover={draft.coverImageUrl} />
    </div>
  );
}

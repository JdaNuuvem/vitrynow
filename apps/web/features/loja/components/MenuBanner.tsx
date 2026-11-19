import { useId } from "react";
import type { Category, Product } from "@/core/domain/storefront";
import { resolveBannerTarget, type MenuBannerConfig } from "../banners";
import { useBrokenImage } from "../hooks/useBrokenImage";

export function MenuBanner({
  banner,
  categories,
  onSelectCategory,
  onOpenProduct,
}: {
  banner?: MenuBannerConfig;
  categories: Category[];
  onSelectCategory: (id: string) => void;
  onOpenProduct: (product: Product) => void;
}) {
  const titleId = useId();
  const image = useBrokenImage(banner?.imageUrl);
  if (!banner) return null;

  const hasImage = Boolean(banner.imageUrl) && !image.failed;
  const hasMedia = Boolean(banner.imageUrl);
  const target = banner.action ? resolveBannerTarget(banner.action.target, categories) : undefined;

  function openTarget() {
    if (target?.kind === "category") onSelectCategory(target.id);
    else if (target?.kind === "product") onOpenProduct(target.product);
  }

  return (
    <section
      className={`loja__banner${hasMedia ? "" : " loja__banner--text-only"}${banner.imageLayout === "cutout" ? " loja__banner--cutout" : ""}`}
      aria-labelledby={titleId}
    >
      {hasMedia && (
        <div className={`loja__banner-media${hasImage ? "" : " loja__banner-media--empty"}`} aria-hidden="true">
          {hasImage && (
            <img
              ref={image.ref}
              className="loja__banner-image"
              src={banner.imageUrl}
              alt=""
              width={1200}
              height={640}
              loading="lazy"
              decoding="async"
              style={{ objectPosition: banner.imagePosition }}
              onError={image.onError}
            />
          )}
        </div>
      )}
      <div className="loja__banner-copy">
        <h2 className="loja__banner-title" id={titleId}>{banner.title}</h2>
        {banner.description && <p className="loja__banner-description">{banner.description}</p>}
        {banner.action && target && (
          <button type="button" className="loja__banner-action" data-banner-action={banner.id} onClick={openTarget}>
            {banner.action.label}
            <span aria-hidden="true">↗</span>
          </button>
        )}
      </div>
    </section>
  );
}

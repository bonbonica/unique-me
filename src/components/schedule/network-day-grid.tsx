import { Check, X } from "lucide-react";
import { PLATFORMS, PLATFORM_LABEL, type GridColumn } from "./batch-detail-view";

/**
 * `<NetworkDayGrid />` — Stage-2 D-S2-15 Network × Day matrix.
 *
 * Renders a semantic HTML `<table>` so the matrix is keyboard-navigable and
 * screen-reader friendly. Header row = day labels; one body row per platform
 * (Facebook → Instagram → LinkedIn). Each body row's label cell AND every
 * data cell wrap a native `<a href="#network-{platform}">` anchor, so a click
 * anywhere on the row jumps to the matching `<article id="network-{platform}">`
 * section below.
 *
 * Why native anchors (not a JS scroll handler):
 *  - Free scroll, focus, and browser back-button parity per §6.9.
 *  - Smooth scroll lives at the document level (DESIGN.md §11 global
 *    `scroll-behavior` rule), automatically disabled by the global
 *    `prefers-reduced-motion: reduce` media query.
 *  - Server-renderable — keeps `<BatchDetailView />` a server component.
 *
 * Architected for new networks: appending `"google_business_profile"` (or
 * `"x"`) to the `PLATFORMS` constant in `batch-detail-view.tsx` + adding a
 * `PLATFORM_LABEL` entry adds a fourth row to the grid AND a fourth section
 * under it with no further restructuring.
 *
 * Column count = `columns.length` = `batch.totalPosts` (NOT hardcoded). On
 * narrow viewports, `overflow-x-auto` lets 9-column Pro batches scroll
 * horizontally without collapsing the cells.
 */
export function NetworkDayGrid({ columns }: { columns: GridColumn[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="p-3 text-left font-medium text-muted-foreground"
            >
              <span className="sr-only">Network</span>
            </th>
            {columns.map((col) => (
              <th
                key={col.postOrder}
                scope="col"
                className="p-3 text-center font-medium text-muted-foreground whitespace-nowrap"
              >
                <span className="block text-xs uppercase tracking-wide">
                  Day {col.postOrder}
                </span>
                <span className="block text-xs">{col.dayLabel}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PLATFORMS.map((platform) => (
            <tr
              key={platform}
              className="border-b border-border last:border-0 hover:bg-muted/60 focus-within:bg-muted/60 transition-colors duration-200"
            >
              <th scope="row" className="p-0">
                <a
                  href={`#network-${platform}`}
                  className="flex items-center gap-2 px-3 py-3 text-left font-medium text-foreground cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring focus-visible:ring-ring focus-visible:ring-[3px]"
                >
                  {PLATFORM_LABEL[platform]}
                </a>
              </th>
              {columns.map((col) => {
                const cell = col.cells[platform];
                const label =
                  cell.kind === "scheduled" ? "scheduled" : "not scheduled";
                return (
                  <td
                    key={col.postOrder}
                    className="p-0 text-center align-middle"
                  >
                    <a
                      href={`#network-${platform}`}
                      aria-label={`${PLATFORM_LABEL[platform]} day ${col.postOrder} — ${label}`}
                      className="block px-3 py-3 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring focus-visible:ring-ring focus-visible:ring-[3px]"
                    >
                      {cell.kind === "scheduled" ? (
                        <Check
                          className="inline size-4 text-primary"
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                      ) : (
                        <X
                          className="inline size-4 text-muted-foreground/60"
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                      )}
                    </a>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

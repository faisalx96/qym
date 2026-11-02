import type { Plugin, Rollup } from 'vite';

/** Text that would end or confuse the inline element it goes into. */
function scriptSafe(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

function styleSafe(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

/**
 * Put the entry script and the stylesheet into the HTML page itself, so the build is one file that opens from disk
 * (the exported run page, C173). Needs `inlineDynamicImports`, `cssCodeSplit: false` and a large
 * `assetsInlineLimit`, so the build has one script, one stylesheet and no other file.
 */
export function inlineSingleFile(): Plugin {
  return {
    name: 'qym-inline-single-file',
    apply: 'build',
    enforce: 'post',
    // After Vite's own generateBundle steps, which fill in the dynamic-import preload lists.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const page = Object.values(bundle).find(
          (file): file is Rollup.OutputAsset => file.type === 'asset' && file.fileName.endsWith('.html'),
        );
        if (!page) return;
        let html = String(page.source);
        for (const [name, file] of Object.entries(bundle)) {
          if (file.type === 'chunk') {
            const chunk = file as Rollup.OutputChunk;
            const tag = new RegExp(
              `<script type="module"[^>]*src="[^"]*${chunk.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>`,
            );
            if (!tag.test(html)) this.error(`No script tag for ${chunk.fileName} in ${page.fileName}`);
            html = html.replace(tag, () => `<script type="module">${scriptSafe(chunk.code)}</script>`);
            delete bundle[name];
          } else if (file.fileName.endsWith('.css')) {
            const tag = new RegExp(
              `<link rel="stylesheet"[^>]*href="[^"]*${file.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`,
            );
            if (!tag.test(html)) this.error(`No stylesheet link for ${file.fileName} in ${page.fileName}`);
            html = html.replace(tag, () => `<style>${styleSafe(String(file.source))}</style>`);
            delete bundle[name];
          }
        }
        const left = Object.keys(bundle).filter((name) => name !== page.fileName);
        if (left.length) this.error(`The single-file build left other files: ${left.join(', ')}`);
        page.source = html;
      },
    },
  };
}

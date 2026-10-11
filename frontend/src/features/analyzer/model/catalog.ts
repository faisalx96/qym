/** Diagnosis category catalog: editable draft, validation and the PUT payload. */
import type { AnalysisConfig, ApprovedExample, CatalogUpdate, CategoryCatalog } from '@/api/analysis';

export interface SubDraft {
  name: string;
  description: string;
  whenToUse: string;
  /** Label seen only in approved examples: shown read-only and never saved. */
  exampleOnly: boolean;
  isNew: boolean;
  touched: boolean;
  /** Taxonomy partially/fully defined at load time (needs both fields to stay valid). */
  hadTaxonomy: boolean;
}

export interface CategoryDraft {
  name: string;
  description: string;
  whenToUse: string;
  subs: SubDraft[];
  exampleCount: number;
  examples: ApprovedExample[];
  isNew: boolean;
}

export interface CatalogDraft {
  categories: CategoryDraft[];
  maxIssues: number;
  revision: number;
}

export function catalogFromConfig(config: AnalysisConfig, catalog?: CategoryCatalog): CatalogDraft {
  const source = catalog ?? config.category_catalog;
  const names = source?.categories?.length ? source.categories : config.default_categories;
  const details = source?.category_details_map ?? config.category_details_map ?? {};
  const taxonomy = source?.category_taxonomy ?? config.category_taxonomy ?? {};
  const subTaxonomy = source?.subcategory_taxonomy ?? config.subcategory_taxonomy ?? {};
  const categories: CategoryDraft[] = names.map((name) => {
    const examples = config.category_examples?.[name] ?? [];
    const saved = details[name] ?? [];
    const subs: SubDraft[] = saved.map((sub) => {
      const tax = subTaxonomy[name]?.[sub] ?? {};
      return {
        name: sub,
        description: tax.description ?? '',
        whenToUse: tax.when_to_use ?? '',
        exampleOnly: false,
        isNew: false,
        touched: false,
        hadTaxonomy: Boolean(tax.description || tax.when_to_use),
      };
    });
    const known = new Set(saved.map((s) => s.toLocaleLowerCase()));
    for (const example of examples) {
      const labels = (example.root_cause_issues ?? []).map((i) => i.subcategory ?? '').concat(example.detail ?? '');
      for (const label of labels.map((l) => l.trim()).filter(Boolean)) {
        if (known.has(label.toLocaleLowerCase())) continue;
        known.add(label.toLocaleLowerCase());
        subs.push({
          name: label,
          description: '',
          whenToUse: '',
          exampleOnly: true,
          isNew: false,
          touched: false,
          hadTaxonomy: false,
        });
      }
    }
    return {
      name,
      description: taxonomy[name]?.description ?? '',
      whenToUse: taxonomy[name]?.when_to_use ?? '',
      subs,
      exampleCount: config.category_example_counts?.[name] ?? examples.length,
      examples,
      isNew: false,
    };
  });
  return {
    categories,
    maxIssues: source?.max_root_cause_categories ?? config.max_root_cause_categories ?? 3,
    revision: Number(source?.version ?? config.category_catalog_version ?? 0),
  };
}

export interface CatalogProblems {
  categories: string[];
  subcategories: string[];
}

export function validateCatalog(draft: CatalogDraft): CatalogProblems {
  const problems: CatalogProblems = { categories: [], subcategories: [] };
  for (const cat of draft.categories) {
    if (!cat.description.trim() || !cat.whenToUse.trim()) problems.categories.push(cat.name);
    for (const sub of cat.subs) {
      if (sub.exampleOnly) continue;
      const hasAny = Boolean(sub.description.trim() || sub.whenToUse.trim());
      const needs = sub.isNew || sub.touched || sub.hadTaxonomy || hasAny;
      if (needs && (!sub.description.trim() || !sub.whenToUse.trim())) {
        problems.subcategories.push(`${cat.name} / ${sub.name}`);
      }
    }
  }
  return problems;
}

export function catalogPayload(draft: CatalogDraft): CatalogUpdate {
  const details: CatalogUpdate['category_details_map'] = {};
  const taxonomy: CatalogUpdate['category_taxonomy'] = {};
  const subTaxonomy: CatalogUpdate['subcategory_taxonomy'] = {};
  for (const cat of draft.categories) {
    const subs = cat.subs.filter((s) => !s.exampleOnly && s.name.trim());
    if (subs.length) details[cat.name] = subs.map((s) => s.name.trim());
    for (const sub of subs) {
      const description = sub.description.trim();
      const when = sub.whenToUse.trim();
      if (description || when) {
        const bucket = (subTaxonomy[cat.name] ??= {});
        bucket[sub.name.trim()] = {
          ...(description ? { description } : {}),
          ...(when ? { when_to_use: when } : {}),
        };
      }
    }
    const description = cat.description.trim();
    const when = cat.whenToUse.trim();
    if (description || when) {
      taxonomy[cat.name] = {
        ...(description ? { description } : {}),
        ...(when ? { when_to_use: when } : {}),
      };
    }
  }
  return {
    categories: draft.categories.map((c) => c.name),
    category_details_map: details,
    category_taxonomy: taxonomy,
    subcategory_taxonomy: subTaxonomy,
    max_root_cause_categories: Math.min(10, Math.max(1, Math.trunc(draft.maxIssues) || 3)),
    base_revision: draft.revision,
  };
}

/** Stable fingerprint of what would be saved (dirty detection without DOM state). */
export function catalogSignature(draft: CatalogDraft): string {
  return JSON.stringify({ ...catalogPayload(draft), base_revision: 0 });
}

/** Approval signature: category -> approved example count/ids, to detect new approvals. */
export function approvalSignature(config: Pick<AnalysisConfig, 'category_examples' | 'category_example_counts'>): string {
  const parts = Object.keys(config.category_example_counts ?? {})
    .sort()
    .map((cat) => {
      const ids = (config.category_examples?.[cat] ?? []).map((e) => e.id).sort((a, b) => a - b);
      return `${cat}:${config.category_example_counts[cat]}:${ids.join(',')}`;
    });
  return parts.join('|');
}

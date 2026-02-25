import type { CreateEventInput } from '../types.js';

// --- Types ---

export interface EspoCrmConfig {
  baseUrl: string;
  apiKey: string;
}

export interface EspoCrmEntity {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface ImportSummary {
  entitiesFetched: number;
  eventsCreated: number;
  errors: Array<{ entity: string; error: string }>;
  durationMs: number;
}

type EntityType = 'Contact' | 'Opportunity' | 'Call' | 'Meeting' | 'Task';

const ENTITY_TYPES: EntityType[] = ['Contact', 'Opportunity', 'Call', 'Meeting', 'Task'];

// --- API Client ---

async function fetchEntities(
  config: EspoCrmConfig,
  entityType: EntityType,
  offset: number = 0,
  maxSize: number = 200,
): Promise<{ list: EspoCrmEntity[]; total: number }> {
  const url = new URL(`/api/v1/${entityType}`, config.baseUrl);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('maxSize', String(maxSize));
  url.searchParams.set('orderBy', 'createdAt');
  url.searchParams.set('order', 'desc');

  const response = await fetch(url.toString(), {
    headers: {
      'X-Api-Key': config.apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`EspoCRM API ${response.status}: ${text}`);
  }

  const data = await response.json() as { list: EspoCrmEntity[]; total: number };
  return data;
}

/**
 * Fetch all entities of a given type, paginating through results.
 */
async function fetchAllEntities(
  config: EspoCrmConfig,
  entityType: EntityType,
): Promise<EspoCrmEntity[]> {
  const pageSize = 200;
  const all: EspoCrmEntity[] = [];
  let offset = 0;

  const first = await fetchEntities(config, entityType, offset, pageSize);
  all.push(...first.list);

  while (all.length < first.total) {
    offset += pageSize;
    const page = await fetchEntities(config, entityType, offset, pageSize);
    all.push(...page.list);
    if (page.list.length === 0) break;
  }

  return all;
}

// --- Entity-to-Event mapping ---

function contactToEvent(entity: EspoCrmEntity): CreateEventInput {
  const name = [entity['firstName'], entity['lastName']].filter(Boolean).join(' ') || entity['name'] || 'Unknown';

  const content = JSON.stringify({
    name,
    emailAddress: entity['emailAddress'] ?? null,
    phoneNumber: entity['phoneNumber'] ?? null,
    title: entity['title'] ?? null,
    accountName: entity['accountName'] ?? null,
    description: entity['description'] ?? null,
  });

  return {
    type: 'observation',
    source: 'espocrm',
    content,
    metadata: {
      espocrm_id: entity['id'],
      espocrm_type: 'Contact',
      name,
      emailAddress: entity['emailAddress'] ?? null,
      createdAt: entity['createdAt'] ?? null,
      modifiedAt: entity['modifiedAt'] ?? null,
    },
  };
}

function opportunityToEvent(entity: EspoCrmEntity): CreateEventInput {
  const name = String(entity['name'] ?? 'Unnamed Deal');

  const content = JSON.stringify({
    name,
    stage: entity['stage'] ?? null,
    amount: entity['amount'] ?? null,
    probability: entity['probability'] ?? null,
    closeDate: entity['closeDate'] ?? null,
    accountName: entity['accountName'] ?? null,
    description: entity['description'] ?? null,
  });

  return {
    type: 'observation',
    source: 'espocrm',
    content,
    metadata: {
      espocrm_id: entity['id'],
      espocrm_type: 'Opportunity',
      name,
      stage: entity['stage'] ?? null,
      amount: entity['amount'] ?? null,
      createdAt: entity['createdAt'] ?? null,
      modifiedAt: entity['modifiedAt'] ?? null,
    },
  };
}

function activityToEvent(entity: EspoCrmEntity, entityType: EntityType): CreateEventInput {
  const name = String(entity['name'] ?? `Unnamed ${entityType}`);

  const content = JSON.stringify({
    name,
    status: entity['status'] ?? null,
    dateStart: entity['dateStart'] ?? null,
    dateEnd: entity['dateEnd'] ?? null,
    duration: entity['duration'] ?? null,
    direction: entity['direction'] ?? null,
    parentType: entity['parentType'] ?? null,
    parentName: entity['parentName'] ?? null,
    description: entity['description'] ?? null,
  });

  return {
    type: 'observation',
    source: 'espocrm',
    content,
    metadata: {
      espocrm_id: entity['id'],
      espocrm_type: entityType,
      name,
      status: entity['status'] ?? null,
      dateStart: entity['dateStart'] ?? null,
      createdAt: entity['createdAt'] ?? null,
      modifiedAt: entity['modifiedAt'] ?? null,
    },
  };
}

/**
 * Map an EspoCRM entity to an Atlas event based on its type.
 */
export function entityToEvent(entity: EspoCrmEntity, entityType: EntityType): CreateEventInput {
  switch (entityType) {
    case 'Contact':
      return contactToEvent(entity);
    case 'Opportunity':
      return opportunityToEvent(entity);
    case 'Call':
    case 'Meeting':
    case 'Task':
      return activityToEvent(entity, entityType);
  }
}

// --- Batch import ---

/**
 * Import all CRM entities from EspoCRM into Atlas as events.
 */
export async function importEntities(
  config: EspoCrmConfig,
  atlasUrl: string,
): Promise<ImportSummary> {
  const start = Date.now();
  const summary: ImportSummary = {
    entitiesFetched: 0,
    eventsCreated: 0,
    errors: [],
    durationMs: 0,
  };

  const eventsUrl = `${atlasUrl.replace(/\/$/, '')}/events`;

  for (const entityType of ENTITY_TYPES) {
    console.log(`Fetching ${entityType} entities...`);

    let entities: EspoCrmEntity[];
    try {
      entities = await fetchAllEntities(config, entityType);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ entity: `${entityType} (fetch)`, error: message });
      console.error(`  Error fetching ${entityType}: ${message}`);
      continue;
    }

    console.log(`  Found ${entities.length} ${entityType} records`);
    summary.entitiesFetched += entities.length;

    for (const entity of entities) {
      const label = `${entityType}:${entity['id']}`;
      try {
        const event = entityToEvent(entity, entityType);

        const response = await fetch(eventsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text}`);
        }

        summary.eventsCreated++;

        if (summary.eventsCreated % 50 === 0) {
          console.log(`  Progress: ${summary.eventsCreated} events created`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push({ entity: label, error: message });
        console.error(`  Error processing ${label}: ${message}`);
      }
    }
  }

  summary.durationMs = Date.now() - start;
  return summary;
}

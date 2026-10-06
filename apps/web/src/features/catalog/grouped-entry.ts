import type { EntryView } from '@fangyu/domain';

export interface GroupedEntryView extends EntryView {
  groupEntryIds?: string[];
  regionPaths?: string[];
}

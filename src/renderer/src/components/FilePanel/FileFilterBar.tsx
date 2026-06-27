import { Search, X } from 'lucide-react';
import { useFileStore } from '../../stores/fileStore';

export function FileFilterBar() {
  const { filterQuery, setFilterQuery } = useFileStore();

  return (
    <div className="px-2 py-1.5 bg-[var(--color-bg-surface)]">
      <div className="flex items-center gap-1.5 bg-[var(--color-bg-sunken)] rounded px-2 py-1">
        <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="筛选文件..."
          className="file-filter-input flex-1 bg-transparent text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
        />
        {filterQuery && (
          <button
            onClick={() => setFilterQuery('')}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

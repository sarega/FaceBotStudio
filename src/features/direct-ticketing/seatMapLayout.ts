export type SpatialSeatInput = {
  zone: string;
  section_label?: string | null;
  row_label: string;
  seat_label: string;
  x?: number | string | null;
  y?: number | string | null;
};

export type SpatialSeatPosition = SpatialSeatInput & { left: number; top: number };

export type SpatialSeatLayout = {
  positioned: SpatialSeatPosition[];
  unpositioned: SpatialSeatInput[];
  coverage: number;
  aspectRatio: number;
};

const finiteCoordinate = (value: number | string | null | undefined) => {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
};

export function buildSpatialSeatLayout(rows: SpatialSeatInput[], zone = ""): SpatialSeatLayout {
  const filtered = rows.filter((row) => (!zone || row.zone === zone) && row.row_label.trim() && row.seat_label.trim());
  const positionedRows = filtered.flatMap((row) => {
    const x = finiteCoordinate(row.x);
    const y = finiteCoordinate(row.y);
    return x == null || y == null ? [] : [{ row, x, y }];
  });
  const unpositioned = filtered.filter((row) => finiteCoordinate(row.x) == null || finiteCoordinate(row.y) == null);
  if (!positionedRows.length) return { positioned: [], unpositioned, coverage: 0, aspectRatio: 1.6 };

  const minX = Math.min(...positionedRows.map(({ x }) => x));
  const maxX = Math.max(...positionedRows.map(({ x }) => x));
  const minY = Math.min(...positionedRows.map(({ y }) => y));
  const maxY = Math.max(...positionedRows.map(({ y }) => y));
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const padding = 6;
  const usable = 100 - padding * 2;
  const positioned = positionedRows.map(({ row, x, y }) => ({
    ...row,
    left: padding + ((x - minX) / rangeX) * usable,
    top: padding + ((y - minY) / rangeY) * usable,
  }));
  return {
    positioned,
    unpositioned,
    coverage: positioned.length / filtered.length,
    aspectRatio: Math.max(0.8, Math.min(2.4, rangeX / rangeY)),
  };
}



export interface Marks {
  json: any;
}

export type Mark = keyof Marks;

export interface Cage<M extends Mark> {
  mark: M;
  data: Marks[M];
}

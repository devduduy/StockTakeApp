export interface CategoryResponse {
  id: string;
  name: string;
  department: {
    id: string;
    name: string;
  };
  division: {
    id: string;
    name: string;
  };
}

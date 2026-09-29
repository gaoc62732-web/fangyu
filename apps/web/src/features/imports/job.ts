export interface ImportJobState {
  phase:
    | 'idle'
    | 'reading'
    | 'matching'
    | 'review'
    | 'applying'
    | 'saving'
    | 'done'
    | 'cancelled'
    | 'error';
  message: string;
  files: string[];
}

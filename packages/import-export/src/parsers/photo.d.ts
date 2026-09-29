export interface PhotoCoordinates {
  lon: number;
  lat: number;
  time: string;
  datum: string;
}
export function photoMetadata(buffer: ArrayBuffer, filename: string): PhotoCoordinates | null;

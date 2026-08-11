// Punto de entrada del paquete: SOLO el núcleo puro.
//
// Los renderers se importan aparte para que un consumidor que solo necesita la
// geometría no arrastre React ni React Native:
//
//   import { calcularPlano } from '@multiplex/seatmap'
//   import { SeatMap, SeatMapView } from '@multiplex/seatmap/web'
//   import { SeatMap, SeatMapView } from '@multiplex/seatmap/native'

export * from './core';

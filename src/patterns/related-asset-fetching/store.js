import { configureStore } from '@reduxjs/toolkit'
import { assetApi } from './api'
import './modules' // side effect: registers every asset module before any hook looks one up

export const store = configureStore({
  reducer: { [assetApi.reducerPath]: assetApi.reducer },
  middleware: (getDefault) => getDefault().concat(assetApi.middleware),
})

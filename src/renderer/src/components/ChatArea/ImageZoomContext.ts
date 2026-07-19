import React from 'react';

export const ImageZoomContext = React.createContext<(url: string) => void>(() => {});

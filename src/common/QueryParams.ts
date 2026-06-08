export const QueryParams = {
  gallery: {
    random: {
      directory: 'dir',
      recursive: 'recursive',
      orientation: 'orientation',
      fromDate: 'fromDate',
      toDate: 'toDate',
      minResolution: 'fromRes',
      maxResolution: 'toRes',
    },
    search: {
      type: 'type',
      query: 'qs',
    },
    map: {
      show: 'map'
    },
    photo: 'p',
    sharingKey_query: 'sk',
    sharingKey_params: 'sharingKey',
    directory: 'directory',
    knownLastModified: 'klm',
    knownLastScanned: 'kls',
    mediaOffset: 'mo',
    mediaLimit: 'ml',
    lightbox: {
      playback: 'play',
      captionAlwaysOn: 'cAO',
      controllersDimmed: 'cd',
      facesAlwaysOn: 'fAO',
      loopVideos: 'lv',
      loopSlideshow: 'ls',
      slideshowSpeed: 'ssp', // in seconds
      titles: {
        topLeftTitle: 'tlt',
        topLeftSubTitle: 'tlst',
        bottomLeftTitle: 'blt',
        bottomLeftSubTitle: 'blst',
      }
    },
    autoPollInterval: 'auInt',
  },
};

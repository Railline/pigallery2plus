import { NgModule } from '@angular/core';
import {
  RouterModule,
  Routes,
  UrlMatchResult,
  UrlSegment,
} from '@angular/router';
import { QueryParams } from '../../common/QueryParams';
import { AuthGuard } from './model/network/helper/auth.guard';

export function galleryMatcherFunction(
  segments: UrlSegment[]
): UrlMatchResult | null {
  if (segments.length === 0) {
    return null;
  }
  const path = segments[0].path;

  const posParams: { [key: string]: UrlSegment } = {};
  if (path === 'gallery') {
    if (segments.length > 1) {
      posParams[QueryParams.gallery.directory] = new UrlSegment(
        segments.slice(1).map(s => s.path).join('/'),
        {}
      );
    }
    return {
      consumed: segments,
      posParams,
    };
  }
  if (path === 'search') {
    if (segments.length > 1) {
      posParams[QueryParams.gallery.search.query] = segments[1];
    }
    return {
      consumed: segments.slice(0, Math.min(segments.length, 2)),
      posParams,
    };
  }
  if (path === 'share') {
    if (segments.length > 1) {
      posParams[QueryParams.gallery.sharingKey_params] = segments[1];
    }
    return {
      consumed: segments.slice(0, Math.min(segments.length, 2)),
      posParams,
    };
  }
  return null;
}

const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./ui/login/login.component')
      .then(({LoginComponent}) => LoginComponent),
  },
  {
    path: 'shareLogin',
    loadComponent: () => import('./ui/sharelogin/share-login.component')
      .then(({ShareLoginComponent}) => ShareLoginComponent),
  },
  {
    path: 'admin',
    loadComponent: () => import('./ui/admin/admin.component')
      .then(({AdminComponent}) => AdminComponent),
    canActivate: [AuthGuard],
  },
  {
    path: 'duplicates',
    loadComponent: () => import('./ui/duplicates/duplicates.component')
      .then(({DuplicateComponent}) => DuplicateComponent),
    canActivate: [AuthGuard],
  },
  {
    path: 'albums',
    loadComponent: () => import('./ui/albums/albums.component')
      .then(({AlbumsComponent}) => AlbumsComponent),
    canActivate: [AuthGuard],
  },
  {
    path: 'faces',
    loadComponent: () => import('./ui/faces/faces.component')
      .then(({FacesComponent}) => FacesComponent),
    canActivate: [AuthGuard],
  },
  {
    path: 'error',
    loadComponent: () => import('./ui/error/error.component')
      .then(({ErrorComponent}) => ErrorComponent),
  },
  {
    matcher: galleryMatcherFunction,
    loadComponent: () => import('./ui/gallery/gallery.component')
      .then(({GalleryComponent}) => GalleryComponent),
    canActivate: [AuthGuard],
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/error', pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}

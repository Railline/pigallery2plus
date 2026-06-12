describe('Share', () => {
  const getSharingKeyFromLink = (link: string): string => {
    const url = new URL(link);
    return url.searchParams.get('sk') ||
      url.pathname.split('/').filter(Boolean).pop() ||
      '';
  };

  beforeEach(() => {
    cy.viewport(1200, 600);
    cy.visit('/');
    cy.get('.card-body');
    cy.get('.col-sm-12').contains('Login');
    /* ==== Generated with Cypress Studio ==== */
    cy.get('#username').type('admin');
    cy.get('#password').clear();
    cy.get('#password').type('admin');
    cy.intercept({
      method: 'GET',
      url: '**/pgapi/gallery/content*',
    }).as('getContent');
    cy.get('.col-sm-12 > .btn').click();
  });
  it('Open password protected sharing', () => {
    cy.get('button#shareButton', {timeout: 15000}).click();
    cy.get('input#share-password').type('secret', {force: true});
    cy.get('button#getShareButton').click();

    cy.get('input#shareLink').should('contain.value', 'http');
    cy.get('input#shareLink')
      .invoke('val')
      .then((link: string) => {
        cy.get('button.btn-close').click();
        cy.get('button#button-frame-menu').click();
        cy.get('#dropdown-frame-menu  ng-icon[name="ionLogOutOutline"]').click({scrollBehavior: false});

        cy.intercept({
          method: 'Get',
          url: '/pgapi/search/*',
        }, (req) => {
          // Remove caching headers to force a 200 OK response from the server
          delete req.headers['if-none-match'];
          delete req.headers['if-modified-since'];
        }).as('getSharedContent');
        const sk = getSharingKeyFromLink(link);
        cy.visit('/shareLogin?sk=' + sk);
        cy.get('input#password', {timeout: 15000})
          .should('be.visible')
          .and('be.enabled')
          .type('secret');
        cy.get('button#button-share-login').click();


        cy.get('app-gallery', { timeout: 15000 }).should('exist');
      });

  });

  it('Open password protected sharing with logged in user', () => {
    cy.get('button#shareButton', {timeout: 15000}).click();
    cy.get('input#share-password').type('secret', {force: true});
    cy.get('button#getShareButton').click();

    cy.get('input#shareLink').should('contain.value', 'http');
    cy.get('input#shareLink')
      .invoke('val')
      .then((link: string) => {

        cy.intercept({
          method: 'Get',
          url: '/pgapi/search/*',
        }, (req) => {
          // Remove caching headers to force a 200 OK response from the server
          delete req.headers['if-none-match'];
          delete req.headers['if-modified-since'];
        }).as('getSharedContent');
         cy.visit(link);


        cy.get('.mb-0 > :nth-child(1) > .nav-link').contains('Gallery');
      });

  });


  it('Open no password sharing', () => {
    cy.get('button#shareButton', {timeout: 15000}).click();
    cy.get('button#getShareButton').click();

    cy.get('input#shareLink').should('contain.value', 'http');
    cy.get('input#shareLink')
      .invoke('val')
      .then((link: string) => {
        cy.get('button.btn-close').click();
        cy.get('button#button-frame-menu').click();
        cy.get('#dropdown-frame-menu  ng-icon[name="ionLogOutOutline"]').click({scrollBehavior: false});


        cy.intercept({
          method: 'Get',
          url: '/pgapi/search/*',
        }, (req) => {
          // Remove caching headers to force a 200 OK response from the server
          delete req.headers['if-none-match'];
          delete req.headers['if-modified-since'];
        }).as('getSharedContent');
        const sk = getSharingKeyFromLink(link);
        cy.request({
          method: 'GET',
          url: '/pgapi/share/' + sk + '?sk=' + sk,
          failOnStatusCode: false
        }).then(() => {
          cy.visit(link);
        });

        cy.get('app-gallery', { timeout: 15000 }).should('exist');
      });
  });
});

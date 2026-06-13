describe('Faces', () => {
  beforeEach(() => {
    cy.request('POST', '/pgapi/user/login', {
      loginCredential: {
        username: 'admin',
        password: 'admin',
        rememberMe: false,
      },
    });
    cy.intercept({
      method: 'GET',
      url: '**/pgapi/person*',
    }).as('getPerson');
    cy.request('/pgapi/gallery/content/?mo=0&mt=120&msm=20&msa=1');
    cy.request('/pgapi/person')
      .its('body.result')
      .should('have.length.greaterThan', 0);
    cy.visit('/faces');
  });
  it('Show faces', () => {
    cy.wait('@getPerson', {timeout: 10000});
    // contains a folder
    cy.get('app-face', {timeout: 20000}).contains('Alvin the Squirrel').should('exist');
  });
  it('Faces should have photos', () => {
    cy.wait('@getPerson', {timeout: 10000});
    // should have a photo
    cy.get('app-face .photo-container .photo', {timeout: 10000}).should('exist');
  });

});

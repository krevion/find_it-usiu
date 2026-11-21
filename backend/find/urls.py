from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('security/login/', views.security_login, name='security_login'),
    path('security/session/', views.security_session, name='security_session'),
    path('security/logout/', views.security_logout, name='security_logout'),
    path('security/claims/', views.security_claims, name='security_claims'),
    path(
        'security/claims/<int:claim_id>/decision/',
        views.decide_claim,
        name='decide_claim',
    ),
    path('checkout/', views.checkout, name='checkout'),
    path('found/', views.found, name='found'),
    path(
        'found/<int:item_id>/claim/',
        views.create_claim,
        name='create_claim',
    ),
    path('services/', views.services, name='services'),
    path('about/', views.about, name='about'),
]
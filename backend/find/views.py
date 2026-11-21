from functools import wraps

from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.paginator import EmptyPage, Paginator
from django.core.validators import validate_email
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST, require_http_methods

from .forms import FoundItemForm
from .models import Claim, FoundItem


def security_required(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Security sign-in is required."}, status=401)
        if not request.user.is_staff:
            return JsonResponse({"error": "Security access is required."}, status=403)
        return view(request, *args, **kwargs)

    return wrapped


@require_POST
def security_login(request):
    user = authenticate(
        request,
        username=request.POST.get("username", "").strip(),
        password=request.POST.get("password", ""),
    )
    if user is None or not user.is_staff or not user.is_active:
        return JsonResponse({"error": "Invalid security credentials."}, status=401)
    if not user.email:
        return JsonResponse(
            {"error": "Ask an administrator to add an email to this account."},
            status=403,
        )

    login(request, user)
    return JsonResponse(
        {
            "authenticated": True,
            "name": user.get_full_name() or user.get_username(),
            "email": user.email,
        }
    )


@require_http_methods(["GET"])
def security_session(request):
    if not request.user.is_authenticated or not request.user.is_staff:
        return JsonResponse({"authenticated": False})
    return JsonResponse(
        {
            "authenticated": True,
            "name": request.user.get_full_name() or request.user.get_username(),
            "email": request.user.email,
        }
    )


@require_POST
def security_logout(request):
    logout(request)
    return JsonResponse({"authenticated": False})


@require_http_methods(["GET", "POST"])
@ensure_csrf_cookie
def found(request):
    if request.method == "POST":
        if not request.user.is_authenticated or not request.user.is_staff:
            return JsonResponse({"error": "Security access is required."}, status=403)

        form = FoundItemForm(request.POST, request.FILES)
        if not form.is_valid():
            return JsonResponse({"errors": form.errors.get_json_data()}, status=400)

        item = form.save(commit=False)
        item.uploaded_by = request.user
        item.save()
        form.save_m2m()
        return JsonResponse(
            {
                "id": item.pk,
                "item_name": item.item_name,
                "category": item.category,
                "photo": request.build_absolute_uri(item.photo.url),
                "message": "Found item submitted.",
            },
            status=201,
        )

    try:
        page_number = int(request.GET.get("page", "1"))
        if page_number < 1:
            raise ValueError
    except ValueError:
        return JsonResponse({"error": "Page must be a positive integer."}, status=400)

    paginator = Paginator(FoundItem.objects.order_by("-created_at"), 20)
    try:
        page = paginator.page(page_number)
    except EmptyPage:
        return JsonResponse({"error": "Page does not exist."}, status=404)

    return JsonResponse(
        {
            "results": [
                {
                    "id": item.pk,
                    "item_name": item.item_name,
                    "category": item.category,
                    "description": item.description,
                    "photo": request.build_absolute_uri(item.photo.url),
                    "location_found": item.location_found,
                    "date_found": item.date_found.isoformat(),
                    "security_question": item.security_question,
                    "status": item.status,
                }
                for item in page.object_list
            ],
            "page": page.number,
            "pages": paginator.num_pages,
        }
    )


@require_POST
def create_claim(request, item_id):
    item = get_object_or_404(FoundItem, pk=item_id)
    if item.status == FoundItem.Status.RETURNED:
        return JsonResponse(
            {"error": "This item has already been returned."},
            status=409,
        )

    rate_limit_key = f"found-item-verification:{item_id}:{request.META.get('REMOTE_ADDR', 'unknown')}"
    failed_attempts = cache.get(rate_limit_key, 0)
    if failed_attempts >= 5:
        return JsonResponse(
            {"error": "Too many incorrect answers. Try again later."},
            status=429,
        )

    answer = request.POST.get("answer", "")
    if not item.verify_security_answer(answer):
        cache.set(rate_limit_key, failed_attempts + 1, timeout=900)
        return JsonResponse({"error": "The answer did not match."}, status=400)

    cache.delete(rate_limit_key)
    claimant_name = request.POST.get("claimant_name", "").strip()
    claimant_email = request.POST.get("claimant_email", "").strip()
    if not claimant_name or not claimant_email:
        return JsonResponse(
            {"error": "Claimant name and email are required."},
            status=400,
        )
    try:
        validate_email(claimant_email)
    except ValidationError:
        return JsonResponse({"error": "Enter a valid claimant email."}, status=400)

    if Claim.objects.filter(
        found_item=item,
        claimant_email__iexact=claimant_email,
        status=Claim.Status.PENDING,
    ).exists():
        return JsonResponse(
            {"error": "You already have a pending claim for this item."},
            status=409,
        )

    claim = Claim.objects.create(
        found_item=item,
        claimant_name=claimant_name,
        claimant_email=claimant_email,
    )
    return JsonResponse(
        {
            "id": claim.pk,
            "status": claim.status,
            "message": "Ownership answer verified. Security will review your claim.",
        },
        status=201,
    )


@require_http_methods(["GET"])
@security_required
def security_claims(request):
    return JsonResponse(
        {
            "results": [
                {
                    "id": claim.pk,
                    "item_id": claim.found_item_id,
                    "item_name": claim.found_item.item_name,
                    "claimant_name": claim.claimant_name,
                    "claimant_email": claim.claimant_email,
                    "status": claim.status,
                    "answer_verified": claim.answer_verified,
                    "submitted_at": claim.submitted_at.isoformat(),
                }
                for claim in Claim.objects.select_related("found_item")
            ]
        }
    )


@require_POST
@security_required
@transaction.atomic
def decide_claim(request, claim_id):
    claim = get_object_or_404(Claim, pk=claim_id)
    if claim.status != Claim.Status.PENDING:
        return JsonResponse({"error": "This claim has already been reviewed."}, status=409)

    status = request.POST.get("status", "")
    if status not in {Claim.Status.APPROVED, Claim.Status.DECLINED}:
        return JsonResponse({"error": "Choose approved or declined."}, status=400)

    claim.status = status
    claim.reviewed_by = request.user
    claim.reviewed_at = timezone.now()
    claim.save(update_fields=["status", "reviewed_by", "reviewed_at"])
    if status == Claim.Status.APPROVED:
        claim.found_item.status = FoundItem.Status.RETURNED
        claim.found_item.save(update_fields=["status"])
    return JsonResponse({"id": claim.pk, "status": claim.status})


@ensure_csrf_cookie
def home(request):
    return render(request, "index.html")


def checkout(request):
    return render(request, "checkout.html")


def services(request):
    return render(request, "services.html")


def about(request):
    return render(request, "about.html")

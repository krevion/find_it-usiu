from django.contrib import admin

from .forms import FoundItemForm
from .models import Claim, FoundItem


@admin.register(FoundItem)
class FoundItemAdmin(admin.ModelAdmin):
    form = FoundItemForm
    list_display = (
        "item_name",
        "location_found",
        "date_found",
        "status",
        "uploaded_by",
        "created_at",
    )
    search_fields = ("item_name", "description", "location_found")
    readonly_fields = ("security_answer_hash", "created_at")


@admin.register(Claim)
class ClaimAdmin(admin.ModelAdmin):
    list_display = (
        "found_item",
        "claimant_name",
        "claimant_email",
        "status",
        "submitted_at",
        "reviewed_by",
    )
    list_filter = ("status", "submitted_at")
    search_fields = ("found_item__item_name", "claimant_name", "claimant_email")
    readonly_fields = (
        "found_item",
        "claimant_name",
        "claimant_email",
        "status",
        "answer_verified",
        "submitted_at",
        "reviewed_by",
        "reviewed_at",
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

from django.contrib.auth.hashers import check_password, make_password
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator
from django.db import models
from django.utils import timezone


def validate_image_size(image):
    max_size = 5 * 1024 * 1024
    if image.size > max_size:
        raise ValidationError("Image must be 5 MB or smaller.")


class FoundItem(models.Model):
    class Status(models.TextChoices):
        FOUND = "found", "Found"
        RETURNED = "returned", "Returned"

    item_name = models.CharField(max_length=120)
    category = models.CharField(max_length=40, default="Other")
    description = models.TextField()
    photo = models.ImageField(
        upload_to="found_items/%Y/%m/",
        validators=[
            FileExtensionValidator(allowed_extensions=["jpg", "jpeg", "png", "webp"]),
            validate_image_size,
        ],
    )
    location_found = models.CharField(max_length=200)
    date_found = models.DateField()
    finder_name = models.CharField(max_length=120)
    finder_contact = models.CharField(max_length=254)
    security_question = models.CharField(max_length=255)
    security_answer_hash = models.CharField(max_length=128, blank=True, editable=False)
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.FOUND,
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_found_items",
    )

    def set_security_answer(self, answer):
        self.security_answer_hash = make_password(answer.strip().casefold())

    def verify_security_answer(self, answer):
        if not self.security_answer_hash:
            return False
        return check_password(answer.strip().casefold(), self.security_answer_hash)

    def __str__(self):
        return self.item_name


class Claim(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        DECLINED = "declined", "Declined"

    found_item = models.ForeignKey(
        FoundItem,
        on_delete=models.CASCADE,
        related_name="claims",
    )
    claimant_name = models.CharField(max_length=120)
    claimant_email = models.EmailField(max_length=254)
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.PENDING,
    )
    answer_verified = models.BooleanField(default=True, editable=False)
    submitted_at = models.DateTimeField(auto_now_add=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_item_claims",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-submitted_at"]

    def __str__(self):
        return f"{self.claimant_name} — {self.found_item.item_name}"
